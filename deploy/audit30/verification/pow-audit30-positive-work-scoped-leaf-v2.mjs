// Local preparation only. Invoke remotely only through a reviewed, source-bound
// owner with a fresh private environment and actual API process identity custody.
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WORK = 'd4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8';
export const ADDRESS = '18hkqE81wQuq75UEBKhB4JjAuQg47jN7Aa';
export const ASSETS = Object.freeze({
  POWB: 'a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562',
  INCB: '3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d',
});
const CANDIDATE = Object.freeze({ commit: '38ac6e2bff2ac16890724e5213346ef8a3ebd186',
  tree: '8b9b5e3cd47aa8e4204da717350a629176e30da6',
  runtimeSha256: '13035b6d1fbca1be9c03b1833f3abe578d4ae28331a341b3dea4301cc72b535c' });
const HEX = /^[0-9a-f]{64}$/u;
const SCALE = 10000000000000000n;
const SOURCE_PINS = Object.freeze({
  'server/proof-api.mjs': '9ab92c0fe3cb358fcaacccd62915eabc4c9ee75e42d29c6c989259b1305436f4',
  'src/App.tsx': '87fd17ac3ade8eff1a5beae96f0bac6b43866d16ac8487d9bc347aa01b2a7ca2',
  'src/shared/api/surfaceReadState.ts': '7c7ceed06f321a5b595a471efa2f9e10e37c64008cd99ed4039f0cad98775b4e',
  'deploy/audit29/verify-candidate.mjs': 'bbded71fa88cfc108c611b3beddd3a6c693b38477c356b682caed8985976abda',
  'deploy/audit5/probe-candidate.mjs': 'edc672e0327248c55eb073f4d720e37a8ea0ac33f61027456b8cf19609aa6ab1',
  'server/work-wallet-capacity.mjs': '98d9ad4071d6b34b8439c59b461eae073584d58ce43140f4214ea129ebce2d86',
});
const FROZEN_HELPERS = {"bindings":[{"path":"deploy/audit5/probe-candidate.mjs","name":"requireFact","start":1238,"end":1313,"sha256":"431157a02c5899b06a52c0a10f687cebe061a8c202f1baf0f9a0904b3a15a01d"},{"path":"deploy/audit5/probe-candidate.mjs","name":"canonicalJson","start":1314,"end":1811,"sha256":"c8f038bfeb82bab7d42424742463d8a73b92563405bc17edef87c4bec634f2dd"},{"path":"deploy/audit5/probe-candidate.mjs","name":"digest","start":3425,"end":3522,"sha256":"fd9868af9487f704feac82bc7aded917ddc164be0ec7e472900b9a031289b80c"},{"path":"deploy/audit5/probe-candidate.mjs","name":"decimalQ8","start":3757,"end":4141,"sha256":"299b6ce40f91a31d6f005a3d0e990991831e653640bb0428eff24f6aa8f67a6e"},{"path":"deploy/audit29/verify-candidate.mjs","name":"sameTip","start":5369,"end":5538,"sha256":"11fa5d724316fb762c00b56d8316c3f20e9da21f4b27c5dd83df5c0f094fd67e"},{"path":"deploy/audit29/verify-candidate.mjs","name":"verifyWalletResponse","start":7103,"end":9920,"sha256":"9d91e692c560e7d61125972b3250597eb1c0435bdb34976961eb7f3d9b088ca3"},{"path":"deploy/audit29/verify-candidate.mjs","name":"verifyFencedWalletRead","start":9922,"end":10190,"sha256":"44b86008570ee542985453b6ca7097b5c227d51e17dc3a6f8b05b7cb0d2d31b0"},{"path":"deploy/audit29/verify-candidate.mjs","name":"makeIO","start":12607,"end":15744,"sha256":"c3880d1725f1ec296ae672a7f0a51f22964b8efd13d6dc16a92f951ca9bf9bd2"},{"path":"src/shared/api/surfaceReadState.ts","name":"listingDisplayProjectionFingerprint","start":2040,"end":4014,"sha256":"94f6f7cdc87a570fbf2ed6dbcfb5745c4c832bee229210643e1c1fa92c69ab47"},{"path":"src/App.tsx","name":"fetchCompleteTokenListings","start":511759,"end":521644,"sha256":"ecc31902e89f2b14d8f5e8719b7f1b03ddc88a90ab44a4c6196c0e508ded370f"}],"code":"function requireFact(ok, code) {\n    if (!ok)\n        throw new Error(code);\n}\n\nfunction canonicalJson(value) {\n    if (value === null || value === undefined)\n        return 'null';\n    if (typeof value === 'bigint')\n        return JSON.stringify(value.toString());\n    if (typeof value !== 'object')\n        return JSON.stringify(value);\n    if (Array.isArray(value))\n        return `[${value.map(canonicalJson).join(',')}]`;\n    return `{${Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))\n        .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;\n}\n\nconst digest = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');\n\nfunction decimalQ8(value) {\n    const text = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;\n    requireFact(typeof text === 'string' && /^(?:0|[1-9]\\d*)(?:\\.\\d{1,8})?$/u.test(text), 'NONCANONICAL_Q8_DECIMAL');\n    const [whole, fraction = ''] = text.split('.');\n    return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));\n}\n\nfunction sameTip(a, b) {\n    return Number.isSafeInteger(a?.height) && a.height > 0 && HEX.test(a.hash ?? \"\") &&\n        a.height === b?.height && a.hash === b?.hash;\n}\n\nfunction verifyWalletResponse(status, payload, address, tip) {\n    requireFact(sameTip(tip, tip), \"WALLET_CHECKPOINT_INVALID\");\n    if (status === 503) {\n        requireFact(payload?.ok === false &&\n            payload.error === `Fresh wallet credit state is temporarily unavailable for ${WORK}.` &&\n            Object.keys(payload).length === 3 &&\n            payload?.details?.code === \"CANONICAL_WALLET_INDEX_UNAVAILABLE\" &&\n            payload.details.requiredSource === \"proof-indexer-wallet-token-overlay\" &&\n            Object.keys(payload.details).length === 2, \"UNQUALIFIED_WALLET_UNAVAILABLE\");\n        return { ready: false, balanceVerified: false, capacityVerified: false, status,\n            verificationStatus: \"known-unresolved-availability\", code: payload.details.code,\n            requiredSource: payload.details.requiredSource, payloadSha256: digest(payload),\n            knownIssueGroups: [\"H24-01\", \"AUD26-02\", \"AUD26-03\", \"PERF-27\"],\n            qualification: \"The exact existing fail-closed unavailable response is retained as unresolved availability. Neither wallet balance nor transfer capacity passed verification; inspect bounded private wallet-token-overlay-unavailable diagnostics.\" };\n    }\n    requireFact(status === 200 && payload.authoritativeWallet === true &&\n        payload.indexedThroughBlock === tip.height && payload.indexedThroughBlockHash === tip.hash, \"WALLET_AUTHORITY_OR_CHECKPOINT_FAILED\");\n    const rows = (payload.holders ?? []).filter((row) => row.address === address && row.tokenId === WORK);\n    const capacities = (payload.canonicalWorkCapacities ?? []).filter((row) => row.address === address);\n    requireFact(rows.length === 1 && capacities.length === 1, \"WALLET_EXACT_CAPACITY_MISSING\");\n    const capacity = capacities[0];\n    requireFact(capacity.model === CANONICAL_WORK_WALLET_CAPACITY_MODEL &&\n        capacity.network === \"livenet\" && capacity.tokenId === WORK &&\n        capacity.indexedThroughBlock === tip.height && capacity.indexedThroughBlockHash === tip.hash, \"WALLET_CAPACITY_SCOPE_FAILED\");\n    const exact = (value) => { requireFact(typeof value === \"string\" && /^(?:0|[1-9][0-9]*)$/u.test(value), \"WALLET_INTEGER_INEXACT\"); return BigInt(value); };\n    const confirmed = exact(capacity.confirmedBalanceSubatoms);\n    const spendable = exact(capacity.transferableBalanceSubatoms);\n    const reserved = exact(capacity.reservedBalanceSubatoms);\n    requireFact(confirmed === exact(rows[0].balanceSubatoms) && confirmed === spendable + reserved, \"WALLET_BALANCE_CONSERVATION_FAILED\");\n    return { ready: true, balanceVerified: true, capacityVerified: true,\n        verificationStatus: \"passed\", status, confirmedBalanceSubatoms: confirmed.toString(),\n        spendableBalanceSubatoms: spendable.toString(), reservedBalanceSubatoms: reserved.toString(),\n        pendingDeltaSubatoms: rows[0].pendingDeltaSubatoms, payloadSha256: digest(payload) };\n}\n\nfunction verifyFencedWalletRead(status, payload, address, before, after) {\n    requireFact(sameTip(before, after), \"CORE_CHECKPOINT_MOVED\");\n    return { ...verifyWalletResponse(status, payload, address, before),\n        checkpoint: { before, after, stable: true } };\n}\n\nasync function makeIO(base, authority, remaining, report) {\n    let httpCalls = 0;\n    let coreCalls = 0;\n    let bytes = 0;\n    const token = process.env.POW_INTERNAL_VERIFIER_TOKEN ?? \"\";\n    requireFact(token.length >= 32, \"PRIVATE_VERIFIER_TOKEN_REQUIRED\");\n    const rpc = new URL(process.env.BITCOIN_RPC_URL ?? \"\");\n    requireFact(rpc.protocol === \"http:\" && [\"127.0.0.1\", \"[::1]\"].includes(rpc.hostname) &&\n        !rpc.username && !rpc.password && process.env.BITCOIN_RPC_USER && process.env.BITCOIN_RPC_PASSWORD, \"LOCAL_PRIVATE_CORE_REQUIRED\");\n    async function body(response, budget) {\n        const parts = [];\n        let size = 0;\n        for await (const part of response.body) {\n            size += part.length;\n            bytes += part.length;\n            requireFact(size <= budget && bytes <= LIMITS.httpBytes, \"READ_BYTE_BUDGET_EXCEEDED\");\n            parts.push(part);\n        }\n        return Buffer.concat(parts);\n    }\n    async function getStatus(path, privateRead = false) {\n        requireFact(++httpCalls <= LIMITS.httpRequests, \"HTTP_REQUEST_BUDGET_EXCEEDED\");\n        const origin = privateRead ? authority : base;\n        const url = new URL(path, origin);\n        requireFact(url.origin === origin && url.pathname.startsWith(\"/api/v1/\"), \"REFUSED_HTTP_PATH\");\n        const response = await fetch(url, { method: \"GET\", redirect: \"error\",\n            signal: AbortSignal.timeout(Math.min(privateRead ? 600_000 : 120_000, remaining())),\n            headers: privateRead ? { \"X-PoW-Internal-Verifier\": token } : {} });\n        const raw = await body(response, LIMITS.bodyBytes);\n        report.reads.push({ route: url.pathname, status: response.status, bytes: raw.length,\n            sha256: createHash(\"sha256\").update(raw).digest(\"hex\") });\n        return { status: response.status, payload: JSON.parse(raw.toString(\"utf8\")) };\n    }\n    return {\n        getStatus,\n        async get(path) {\n            const result = await getStatus(path);\n            requireFact(result.status === 200, `HTTP_${result.status}`);\n            return result.payload;\n        },\n        async core(method, params = []) {\n            requireFact([\"getblockchaininfo\", \"gettxout\"].includes(method) && ++coreCalls <= LIMITS.coreRequests, \"CORE_METHOD_OR_REQUEST_BUDGET_EXCEEDED\");\n            const response = await fetch(rpc, { method: \"POST\", redirect: \"error\",\n                signal: AbortSignal.timeout(Math.min(15_000, remaining())),\n                headers: { \"Content-Type\": \"application/json\", Authorization: \"Basic \" +\n                        Buffer.from(`${process.env.BITCOIN_RPC_USER}:${process.env.BITCOIN_RPC_PASSWORD}`).toString(\"base64\") },\n                body: JSON.stringify({ jsonrpc: \"2.0\", id: coreCalls, method, params }) });\n            const raw = await body(response, 1024 * 1024);\n            requireFact(response.ok, \"CORE_READ_UNAVAILABLE\");\n            const json = JSON.parse(raw.toString(\"utf8\"));\n            requireFact(!json.error, \"CORE_READ_REFUSED\");\n            if (method === \"gettxout\" && json.result) {\n                const matches = [...raw.toString(\"utf8\").matchAll(/\"value\"\\s*:\\s*(\\d+(?:\\.\\d+)?)(?=\\s*[,}])/gu)];\n                requireFact(matches.length === 1, \"CORE_VALUE_LEXEME_MISSING\");\n                json.result.exactValueProofs = decimalQ8(matches[0][1]).toString();\n            }\n            return json.result;\n        },\n        counters: () => ({ httpCalls, coreCalls, bytes }),\n    };\n}\n\nfunction listingDisplayProjectionFingerprint(page) {\n    const projection = page.itemProjection;\n    const hash = (value) => typeof value === \"string\" && /^[0-9a-f]{64}$/u.test(value);\n    if ((projection?.model !== \"proof-token-listing-display-v1\" &&\n        projection?.model !== \"proof-token-listing-display-v2\") ||\n        !hash(projection.fullMembershipSha256) || !hash(projection.fullSourceSha256)) {\n        throw new Error(\"Listing display projection lacks full evidence digests.\");\n    }\n    const allowed = new Set([\"workAmoV5ReplayOutput\", \"workAmoV5ReplayRawWitness\", \"workAmoV5RawScriptWitness\"]);\n    if (projection.model === \"proof-token-listing-display-v2\") {\n        for (const field of [\"parsed\", \"listing\", \"payload\"])\n            allowed.add(field);\n    }\n    for (const item of page.items ?? []) {\n        const evidence = item.displayEvidence;\n        if (evidence?.model !== projection.model || !hash(evidence.fullRecordSha256) ||\n            !Array.isArray(evidence.omittedFields) || !evidence.omittedFields.every((field) => allowed.has(field)) ||\n            typeof evidence.fullDetailPath !== \"string\" || !evidence.fullDetailPath.startsWith(\"/api/v1/token-history?\")) {\n            throw new Error(\"Listing display row lacks retrievable full evidence.\");\n        }\n        const query = new URL(evidence.fullDetailPath, \"https://proof.invalid\").searchParams;\n        if (query.get(\"kind\") !== \"listings\" || query.get(\"projection\") !== \"full\" ||\n            query.get(\"q\") !== item.listingId || query.get(\"listingId\") !== item.listingId) {\n            throw new Error(\"Listing full evidence reference does not match its ID.\");\n        }\n    }\n    return JSON.stringify([projection.model, projection.fullMembershipSha256, projection.fullSourceSha256]);\n}\n\nasync function fetchCompleteTokenListings(targetNetwork, options = {}) {\n    const tokenScope = options.tokenScope?.trim().toLowerCase() ?? \"\";\n    if (tokenScope && !/^[0-9a-f]{64}$/u.test(tokenScope)) {\n        throw new Error(\"The complete credit listing scope is invalid.\");\n    }\n    const deadline = AbortSignal.timeout(120_000);\n    const signal = options.signal\n        ? AbortSignal.any([options.signal, deadline])\n        : deadline;\n    const listings = [];\n    const listingIds = new Set();\n    const seenCursors = new Set();\n    let cursor = \"\";\n    let expectedIndexedAt = \"\";\n    let expectedIndexedThroughBlock = 0;\n    let expectedIndexedThroughBlockHash = \"\";\n    let expectedSnapshotId = \"\";\n    let expectedTotalCount = -1;\n    let expectedAuthorityFingerprint = \"\";\n    let expectedProjectionFingerprint = \"\";\n    let expectedItemProjectionFingerprint = \"\";\n    for (let pageIndex = 0; pageIndex < MAX_TOKEN_HISTORY_PAGES; pageIndex += 1) {\n        signal.throwIfAborted();\n        const page = await fetchTokenHistoryPage(targetNetwork, \"listings\", {\n            signal,\n            address: options.address,\n            projection: \"display-v2\",\n            cursor: cursor || undefined,\n            fresh: options.fresh,\n            pageSize: TOKEN_HISTORY_PAGE_SIZE,\n            tokenScope: tokenScope || undefined,\n        });\n        signal.throwIfAborted();\n        const pageIndexedAt = String(page.indexedAt ?? \"\").trim();\n        const pageIndexedThroughBlock = Number(page.indexedThroughBlock);\n        const pageIndexedThroughBlockHash = String(page.indexedThroughBlockHash ?? \"\")\n            .trim()\n            .toLowerCase();\n        const pageSnapshotId = String(page.snapshotId ?? \"\").trim();\n        const pageTotalCount = Number(page.totalCount);\n        const pageItems = page.items ?? [];\n        const pageStart = Number(page.start);\n        const pageEnd = Number(page.end);\n        const pageLimit = Number(page.limit);\n        const pageNumber = Number(page.page);\n        const pageCount = Number(page.pageCount);\n        const nextCursor = String(page.nextCursor ?? \"\").trim();\n        const authority = page.listingAuthority;\n        const authorityHeight = Number(authority?.checkpoint?.height);\n        const authorityHash = String(authority?.checkpoint?.blockHash ?? \"\")\n            .trim()\n            .toLowerCase();\n        const authorityDigest = String(authority?.checkedOutpointsSha256 ?? \"\")\n            .trim()\n            .toLowerCase();\n        const authorityCheckedCount = Number(authority?.checkedListingCount);\n        const authorityInputCount = Number(authority?.inputListingCount);\n        const authorityOutputCount = Number(authority?.outputListingCount);\n        const authoritySpentCount = Number(authority?.spentListingCount);\n        const authorityUnspentCount = Number(authority?.unspentListingCount);\n        const projection = page.listingProjection;\n        const projectionActiveCount = Number(projection?.activeListingCount);\n        const projectionCoreUnspentCount = Number(projection?.coreUnspentListingCount);\n        const projectionExcludedCount = Number(projection?.excludedByProtocolCount);\n        const projectionDigest = String(projection?.membershipSha256 ?? \"\")\n            .trim()\n            .toLowerCase();\n        const broadUnfilteredBook = !options.address?.trim() && !tokenScope;\n        if (!pageIndexedAt ||\n            !Number.isFinite(Date.parse(pageIndexedAt)) ||\n            !Number.isSafeInteger(pageIndexedThroughBlock) ||\n            pageIndexedThroughBlock < 1 ||\n            !/^[0-9a-f]{64}$/u.test(pageIndexedThroughBlockHash) ||\n            !/^[0-9a-f]{64}$/u.test(pageSnapshotId) ||\n            !Number.isSafeInteger(pageTotalCount) ||\n            pageTotalCount < 0 ||\n            page.kind !== \"listings\" ||\n            page.network !== targetNetwork ||\n            page.source !==\n                \"proof-indexer-complete-core-reconciled-token-listings\" ||\n            String(page.cursor ?? \"\") !== cursor ||\n            !Number.isSafeInteger(pageStart) ||\n            pageStart !== listings.length ||\n            !Number.isSafeInteger(pageEnd) ||\n            pageEnd !== pageStart + pageItems.length ||\n            pageEnd > pageTotalCount ||\n            pageLimit !== TOKEN_HISTORY_PAGE_SIZE ||\n            pageNumber !== Math.floor(pageStart / pageLimit) ||\n            pageCount !==\n                Math.max(1, Math.ceil(pageTotalCount / TOKEN_HISTORY_PAGE_SIZE)) ||\n            page.hasMore !== (pageEnd < pageTotalCount) ||\n            Boolean(nextCursor) !== page.hasMore ||\n            authority?.model !== \"proof-token-market-core-gettxout-v1\" ||\n            authority?.includeMempool !== true ||\n            authorityHeight !== pageIndexedThroughBlock ||\n            authorityHash !== pageIndexedThroughBlockHash ||\n            !/^[0-9a-f]{64}$/u.test(authorityDigest) ||\n            !Number.isSafeInteger(authorityCheckedCount) ||\n            !Number.isSafeInteger(authorityInputCount) ||\n            !Number.isSafeInteger(authorityOutputCount) ||\n            !Number.isSafeInteger(authoritySpentCount) ||\n            !Number.isSafeInteger(authorityUnspentCount) ||\n            authorityCheckedCount < 0 ||\n            authorityInputCount !== authorityCheckedCount ||\n            authoritySpentCount < 0 ||\n            authorityUnspentCount < 0 ||\n            authorityOutputCount !== authorityUnspentCount ||\n            authoritySpentCount + authorityUnspentCount !== authorityCheckedCount ||\n            projection?.model !== \"proof-token-market-cutover-after-core-v1\" ||\n            !/^[0-9a-f]{64}$/u.test(projectionDigest) ||\n            !Number.isSafeInteger(projectionActiveCount) ||\n            !Number.isSafeInteger(projectionCoreUnspentCount) ||\n            !Number.isSafeInteger(projectionExcludedCount) ||\n            projectionActiveCount < 0 ||\n            projectionCoreUnspentCount !== authorityUnspentCount ||\n            projectionExcludedCount < 0 ||\n            projectionActiveCount + projectionExcludedCount !==\n                projectionCoreUnspentCount ||\n            pageTotalCount > projectionActiveCount ||\n            (broadUnfilteredBook && pageTotalCount !== projectionActiveCount) ||\n            pageItems.some((listing) => listing.network !== targetNetwork ||\n                listing.confirmed !== true ||\n                (tokenScope !== \"\" && listing.tokenId !== tokenScope))) {\n            throw new Error(\"The complete credit listing book lacks exact checkpoint evidence.\");\n        }\n        const itemProjectionFingerprint = listingDisplayProjectionFingerprint(page);\n        const authorityFingerprint = JSON.stringify({\n            checkedListingCount: authorityCheckedCount,\n            checkedOutpointsSha256: authorityDigest,\n            checkpointBlockHash: authorityHash,\n            checkpointHeight: authorityHeight,\n            inputListingCount: authorityInputCount,\n            outputListingCount: authorityOutputCount,\n            spentListingCount: authoritySpentCount,\n            unspentListingCount: authorityUnspentCount,\n        });\n        const projectionFingerprint = JSON.stringify({\n            activeListingCount: projectionActiveCount,\n            coreUnspentListingCount: projectionCoreUnspentCount,\n            excludedByProtocolCount: projectionExcludedCount,\n            membershipSha256: projectionDigest,\n        });\n        if (pageIndex === 0) {\n            expectedIndexedAt = pageIndexedAt;\n            expectedIndexedThroughBlock = pageIndexedThroughBlock;\n            expectedIndexedThroughBlockHash = pageIndexedThroughBlockHash;\n            expectedSnapshotId = pageSnapshotId;\n            expectedTotalCount = pageTotalCount;\n            expectedAuthorityFingerprint = authorityFingerprint;\n            expectedProjectionFingerprint = projectionFingerprint;\n            expectedItemProjectionFingerprint = itemProjectionFingerprint;\n        }\n        else if (pageIndexedAt !== expectedIndexedAt ||\n            pageIndexedThroughBlock !== expectedIndexedThroughBlock ||\n            pageIndexedThroughBlockHash !== expectedIndexedThroughBlockHash ||\n            pageSnapshotId !== expectedSnapshotId ||\n            pageTotalCount !== expectedTotalCount ||\n            authorityFingerprint !== expectedAuthorityFingerprint ||\n            projectionFingerprint !== expectedProjectionFingerprint ||\n            itemProjectionFingerprint !== expectedItemProjectionFingerprint) {\n            throw new Error(\"The complete credit listing book changed checkpoints while paging.\");\n        }\n        for (const listing of pageItems) {\n            const listingId = String(listing.listingId ?? \"\")\n                .trim()\n                .toLowerCase();\n            if (!/^[0-9a-f]{64}$/u.test(listingId) || listingIds.has(listingId)) {\n                throw new Error(\"The complete credit listing book returned an invalid or repeated listing.\");\n            }\n            listingIds.add(listingId);\n            listings.push(listing);\n        }\n        if (!nextCursor) {\n            if (listings.length !== expectedTotalCount) {\n                throw new Error(`The complete credit listing book returned ${listings.length} of ${expectedTotalCount} listings.`);\n            }\n            const completeHistory = {\n                indexedAt: expectedIndexedAt,\n                indexedThroughBlock: expectedIndexedThroughBlock,\n                indexedThroughBlockHash: expectedIndexedThroughBlockHash,\n                items: listings,\n                snapshotId: expectedSnapshotId,\n                totalCount: expectedTotalCount,\n            };\n            options.onVerifiedPage?.({ ...completeHistory, complete: true });\n            return completeHistory;\n        }\n        if (seenCursors.has(nextCursor)) {\n            throw new Error(\"The complete credit listing cursor repeated.\");\n        }\n        seenCursors.add(nextCursor);\n        options.onVerifiedPage?.({\n            indexedAt: expectedIndexedAt,\n            indexedThroughBlock: expectedIndexedThroughBlock,\n            indexedThroughBlockHash: expectedIndexedThroughBlockHash,\n            items: [...listings],\n            snapshotId: expectedSnapshotId,\n            totalCount: expectedTotalCount,\n            complete: false,\n        });\n        cursor = nextCursor;\n    }\n    throw new Error(\"The complete credit listing book exceeded its page limit.\");\n}\n","codeSha256":"37baad290031edee701ce664e9159798249d83e32cff14c1735168a7b3fe8d59"};
export const sha = (value) => createHash('sha256').update(value).digest('hex');
const need = (condition, code) => { if (!condition) throw new Error(code); };

export function helpers(fetchTokenHistoryPage, limits) {
  need(FROZEN_HELPERS && sha(FROZEN_HELPERS.code) === FROZEN_HELPERS.codeSha256,
    'FROZEN_HELPER_CODE_CHANGED');
  return new Function('createHash', 'WORK', 'HEX', 'CANONICAL_WORK_WALLET_CAPACITY_MODEL',
    'fetchTokenHistoryPage', 'MAX_TOKEN_HISTORY_PAGES', 'TOKEN_HISTORY_PAGE_SIZE', 'LIMITS',
    '"use strict";\n' + FROZEN_HELPERS.code + '\nreturn {sameTip, verifyFencedWalletRead, makeIO, fetchCompleteTokenListings, digest};')
    (createHash, WORK, HEX, 'canonical-work-wallet-capacity-v1', fetchTokenHistoryPage, 100, 200, limits);
}

function unsigned(value) {
  need(typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value), 'NONCANONICAL_Q16_INTEGER');
  return BigInt(value);
}
function signed(value) {
  need(typeof value === 'string' && /^(?:0|-?[1-9][0-9]*)$/u.test(value), 'NONCANONICAL_Q16_SIGNED_INTEGER');
  return BigInt(value);
}
export function decimalQ16(value) {
  need(typeof value === 'string' && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,16})?$/u.test(value),
    'NONCANONICAL_Q16_DECIMAL');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const exact = BigInt(whole) * SCALE + BigInt(fraction.padEnd(16, '0'));
  need(!negative || exact !== 0n, 'NONCANONICAL_Q16_NEGATIVE_ZERO');
  return negative ? -exact : exact;
}
const q16Model = (value) => value?.decimals === 16 && value?.unitScale === SCALE.toString() &&
  value?.amountStorageModel === 'work-subatoms-v2' && value?.precisionModel === 'canonical-work-subatoms-v2';

export function verifyPositiveWork(status, payload, before, after, h = helpers()) {
  const predicates = {};
  const check = (name, condition) => { predicates[name] = condition === true; need(condition === true, name); };
  check('http-200-required', status === 200);
  check('livenet-scope', payload?.network === 'livenet');
  check('authoritative-wallet', payload?.authoritativeWallet === true);
  check('complete-checkpoint', payload?.checkpointComplete === true);
  check('stable-core-fence', h.sameTip(before, after));
  check('exact-current-checkpoint', payload?.indexedThroughBlock === before.height &&
    payload?.indexedThroughBlockHash === before.hash);
  check('snapshot-present', typeof payload?.snapshotId === 'string' && /^[0-9a-f]{24,64}$/u.test(payload.snapshotId));
  check('envelope-q16-model', q16Model(payload));
  const tokens = Array.isArray(payload?.tokens) ? payload.tokens.filter((row) => row?.tokenId === WORK) : [];
  check('one-canonical-q16-token', tokens.length === 1 && q16Model(tokens[0]));
  const holders = Array.isArray(payload?.holders) ? payload.holders.filter((row) => row?.address === ADDRESS && row?.tokenId === WORK) : [];
  check('one-exact-holder', holders.length === 1);
  const capacities = Array.isArray(payload?.canonicalWorkCapacities) ?
    payload.canonicalWorkCapacities.filter((row) => row?.address === ADDRESS) : [];
  check('one-exact-capacity', capacities.length === 1);
  const holder = holders[0]; const capacity = capacities[0];
  check('capacity-scope-model-checkpoint', capacity?.model === 'canonical-work-wallet-capacity-v1' &&
    capacity.network === 'livenet' && capacity.tokenId === WORK && capacity.indexedThroughBlock === before.height &&
    capacity.indexedThroughBlockHash === before.hash);
  const confirmed = unsigned(capacity.confirmedBalanceSubatoms);
  const spendable = unsigned(capacity.transferableBalanceSubatoms);
  const reserved = unsigned(capacity.reservedBalanceSubatoms);
  const pending = signed(holder.pendingDeltaSubatoms);
  check('positive-confirmed-exact-holder', confirmed > 0n && unsigned(holder.balanceSubatoms) === confirmed);
  check('exact-q16-conservation', confirmed === spendable + reserved);
  check('holder-decimals-match-subatoms', decimalQ16(holder.balance) === confirmed && decimalQ16(holder.pendingDelta) === pending);
  const reservations = capacity.reservations;
  let reservationsValid = Array.isArray(reservations) && reservations.length <= 2000;
  let reservationSum = 0n; let previous = '';
  if (reservationsValid) for (const row of reservations) {
    if (!HEX.test(row?.listingId ?? '') || row.listingId <= previous ||
        typeof row.amountSubatoms !== 'string' || !/^[1-9][0-9]*$/u.test(row.amountSubatoms)) {
      reservationsValid = false; break;
    }
    previous = row.listingId; reservationSum += BigInt(row.amountSubatoms);
  }
  check('exact-unique-reservation-conservation', reservationsValid && reservationSum === reserved);
  const verified = h.verifyFencedWalletRead(status, payload, ADDRESS, before, after);
  need(Object.keys(predicates).length === 16 && Object.values(predicates).every((value) => value === true) &&
    verified.ready === true && verified.balanceVerified === true && verified.capacityVerified === true,
    'POSITIVE_WALLET_ALL_SIXTEEN_REQUIRED');
  return { ...verified, predicates, predicateCount: 16, positiveConfirmed: true,
    holderBalanceDecimal: holder.balance, holderPendingDeltaDecimal: holder.pendingDelta,
    decimals: payload.decimals, unitScale: payload.unitScale, snapshotId: payload.snapshotId,
    reservationCount: reservations.length, reservationMembershipSha256: h.digest(reservations) };
}

export async function validateSources(root) {
  need(await realpath(root) === root, 'CHECKOUT_REALPATH_CHANGED');
  const texts = new Map();
  for (const [relative, expected] of Object.entries(SOURCE_PINS)) {
    const path = resolve(root, relative); need(await realpath(path) === path, 'SOURCE_SYMLINK_REFUSED');
    const raw = await readFile(path); need(sha(raw) === expected, 'CANDIDATE_SOURCE_CHANGED');
    texts.set(relative, raw.toString('utf8'));
  }
  for (const binding of FROZEN_HELPERS.bindings) {
    need(sha(texts.get(binding.path).slice(binding.start, binding.end)) === binding.sha256,
      'FROZEN_EXTRACTION_SOURCE_CHANGED');
  }
  return { files: SOURCE_PINS, helpers: FROZEN_HELPERS.bindings,
    frozenCodeSha256: FROZEN_HELPERS.codeSha256, extraction: 'exact named AST functions, TypeScript syntax erased locally; no application startup' };
}

export async function collect(mode, root = process.cwd()) {
  need(['shadow', 'production'].includes(mode), 'MODE_REQUIRED');
  need(mode === 'shadow' ? root.startsWith('/opt/proofofwork-api-stage-') : root === '/opt/proofofwork-api',
    'CHECKOUT_ROLE_MISMATCH');
  need(process.version === 'v24.18.0' && process.versions.unicode === '17.0', 'PINNED_NODE_UNICODE_REQUIRED');
  const base = mode === 'shadow' ? 'http://127.0.0.1:18081' : 'https://computer.proofofwork.me';
  const authority = mode === 'shadow' ? base : 'http://127.0.0.1:8081';
  const limits = { httpRequests: 96, coreRequests: 8, bodyBytes: 3 * 1024 ** 2,
    httpBytes: 192 * 1024 ** 2, overallMilliseconds: 330000,
    walletMilliseconds: 20000, scopeMilliseconds: 120000, pagesPerScope: 100, pageRows: 200 };
  const report = { schema: 'pow-audit30-positive-work-complete-scoped-listings-v1', ok: false,
    candidate: CANDIDATE, mode, base, authority, network: 'livenet', startedAt: new Date().toISOString(),
    limits: { ...limits }, reads: [], positiveWork: [], scopedListings: [], productionMutation: false,
    timerChanges: false, privateContentsExported: false,
    qualification: 'Fresh observed conservation and per-read/per-scope Core fences are binding. Historical balances/counts are baseline only. First and second reads do not assert an empty cache. Raw listing membership is checked without frontend normalization. API supplies Core outpoint authority; individual gettxout results are not repeated. Actual API identity and fresh private environment custody must be bound by the reviewed owner.' };
  const started = Date.now(); let phaseDeadline = started + limits.overallMilliseconds; let io;
  const remaining = () => { const milliseconds = Math.min(started + limits.overallMilliseconds, phaseDeadline) - Date.now();
    need(milliseconds > 0, 'COLLECTOR_DEADLINE'); return milliseconds; };
  try {
    report.sourceBindings = await validateSources(root);
    const h = helpers(async (network, kind, options) => {
      need(network === 'livenet' && kind === 'listings' && options.projection === 'display-v2' &&
        options.fresh === true && options.pageSize === 200 && Object.values(ASSETS).includes(options.tokenScope) &&
        !options.address, 'FIXED_SCOPED_LISTING_REQUEST_REQUIRED');
      options.signal.throwIfAborted();
      const query = new URLSearchParams({ kind, projection: 'display-v2', limit: '200', fresh: '1',
        asset: options.tokenScope, network });
      if (options.cursor) query.set('cursor', options.cursor); else query.set('page', '0');
      const payload = await io.get('/api/v1/token-history?' + query);
      options.signal.throwIfAborted(); return payload;
    }, limits);
    io = await h.makeIO(base, authority, remaining, report);
    const readTip = async () => { const core = await io.core('getblockchaininfo');
      need(core?.chain === 'main' && core.initialblockdownload === false &&
        Number.isSafeInteger(core.blocks) && core.blocks > 0 && HEX.test(core.bestblockhash ?? ''), 'CORE_NOT_HEALTHY');
      return { height: core.blocks, hash: core.bestblockhash }; };
    for (const label of ['first-request', 'second-request']) {
      phaseDeadline = Date.now() + limits.walletMilliseconds; limits.bodyBytes = 3 * 1024 ** 2;
      const before = await readTip(); const requestStarted = Date.now();
      const response = await io.getStatus('/api/v1/token?' + new URLSearchParams({ network: 'livenet', asset: 'WORK',
        wallet: '1', fresh: '1', address: ADDRESS }));
      const after = await readTip();
      const result = verifyPositiveWork(response.status, response.payload, before, after, h);
      report.positiveWork.push({ label, ...result, httpAndFenceSeconds: (Date.now() - requestStarted) / 1000,
        maximumStageSeconds: 20, maximumResponseBytes: 3 * 1024 ** 2 });
    }
    for (const [symbol, asset] of Object.entries(ASSETS)) {
      phaseDeadline = Date.now() + limits.scopeMilliseconds; limits.bodyBytes = 32 * 1024 ** 2;
      const before = await readTip(); const pages = [];
      const history = await h.fetchCompleteTokenListings('livenet', { fresh: true, tokenScope: asset,
        onVerifiedPage: (page) => pages.push({ complete: page.complete, verifiedThrough: page.items.length,
          totalCount: page.totalCount, indexedAt: page.indexedAt, snapshotId: page.snapshotId,
          checkpoint: { height: page.indexedThroughBlock, hash: page.indexedThroughBlockHash } }) });
      const after = await readTip();
      const checkpoint = { height: history.indexedThroughBlock, hash: history.indexedThroughBlockHash };
      need(h.sameTip(before, after) && h.sameTip(before, checkpoint), 'SCOPED_CORE_CHECKPOINT_MOVED');
      need(pages.length > 0 && pages.at(-1).complete === true && history.items.length === history.totalCount,
        'SCOPED_COMPLETE_MEMBERSHIP_REQUIRED');
      report.scopedListings.push({ symbol, asset, complete: true, ready: true, checkpoint,
        coreBefore: before, coreAfter: after, indexedAt: history.indexedAt, snapshotId: history.snapshotId,
        pages, totalCount: history.totalCount, listingIdsSha256: h.digest(history.items.map((row) => row.listingId).sort()),
        historicalCountBaseline: symbol === 'POWB' ? 1 : 0 });
    }
    need(report.positiveWork.length === 2 && report.scopedListings.length === 2, 'ALL_SCOPES_REQUIRED');
    report.ok = true;
  } catch (error) {
    report.failure = /^[A-Z0-9_-]+$/u.test(error?.message ?? '') ? error.message : 'SOURCE_HELPER_OR_TRANSPORT_REFUSED';
    report.errorClass = error?.constructor?.name ?? 'UnknownError';
  } finally {
    report.completedAt = new Date().toISOString(); report.elapsedMilliseconds = Date.now() - started;
    if (io) report.counters = io.counters();
  }
  return report;
}

async function main() {
  const argv = process.argv.slice(2);
  need(argv.length === 4 && argv[0] === '--mode' && argv[2] === '--output', 'EXACT_ARGUMENTS_REQUIRED');
  const output = resolve(argv[3]); need(output === argv[3] && await realpath(dirname(output)) === dirname(output),
    'OUTPUT_REALPATH_REQUIRED');
  const report = await collect(argv[1]);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ok: report.ok, failure: report.failure ?? null, output,
    receiptSha256: sha(await readFile(output)) }));
  if (!report.ok) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error('audit30_positive_scoped status=refused'); process.exitCode = 1; });
}
