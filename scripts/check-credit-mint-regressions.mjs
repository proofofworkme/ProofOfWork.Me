#!/usr/bin/env node

const DEFAULT_API_BASE = "https://credit.proofofwork.me";
const API_BASE = String(process.env.POW_API_BASE ?? DEFAULT_API_BASE).replace(
  /\/+$/u,
  "",
);
const NETWORK = String(process.env.POW_NETWORK ?? "livenet");
const FETCH_TIMEOUT_MS = Number(
  process.env.POW_CREDIT_MINT_CHECK_TIMEOUT_MS ?? 90_000,
);

const POW_TOKEN_ID =
  "e5c5ba610cf56e3fc31f8937d042497ca827f6a5d01eca7dcd05c2bbbbad1f4f";
const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const WORK_RECENT_MINTER_REGRESSION_ADDRESS =
  "1447TsdXtFSnVrWawSamyyQKPDNW4ALtBT";
const WORK_CONFIRMED_MINT_REGRESSION_TXIDS = [
  "4f108a01a333612070be59b32cb2a2e86665ebfc97f9d6d18a8506127c5e7be5",
  "2a03b69a5afe3e114c83798e17f885c2bd197578b15bff6ac7a3ba649fd83841",
  "d238c95dd40c597455d041c5264f71903d9e0572a0535b18cd1987325591e3a6",
  "922c9f9051372f3d7f6a3d8becc399869f65a6e3bc6fb1c1e241076ab18b7c7e",
  "8314e49e583294a7118c1b8794ff9208c2b8fd910f26913ee8a00175266d7fcb",
  "fd14c06c25b668c53c663b72f95c7166f8f8aee3d02aacbb464a1e33c39c31cb",
  "7ed299b4696fd35c4c498dfc25fa1191deaa96d9083feb6d7ca69719cd2098b8",
  "7463a27cbc86b2f828d28bb856ae895505fec2a4679095cfa0f4c24fd25fe135",
  "8c08b946634963ae23f6d40c55df12ab2786d7e6b259a0574cbdd21d6eef20ae",
  "f422ed5d53c49237498cb20906d3ddbb0ab5c3330c5513a468cb472ce198263e",
  "89168a6b6cb4c9678ee42d5e70364f462d552aba900973076497ee2583364d73",
  "9e11fd35dc843f84e39fcaa6fd110bd9a014d8281f32e21298592af71513a25a",
  "5fa28612c2d4d3945bafd09c6eaeb267efe9735387e47aa1aaf638dfc576a0cc",
  "9b02313ab8748a5ff73cb6173d2ffa3fa72f70ffe5a51f396adc3455f2a657bb",
  "e31d5bc5f25a50de7f1c99dc15e4742b939510d7643a31d9049f729da01223e9",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function timeValue(value) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? time : 0;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getJson(path, params = {}) {
  const url = new URL(path, `${API_BASE}/`);
  url.searchParams.set("network", NETWORK);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

function findToken(payload, tokenId, ticker) {
  const tokens = Array.isArray(payload?.tokens) ? payload.tokens : [];
  const token = tokens.find(
    (token) =>
      token?.tokenId === tokenId ||
      String(token?.ticker ?? "").toUpperCase() === ticker,
  );
  if (!token || tokens.length !== 1) {
    return token;
  }
  return {
    ...token,
    confirmedMints: token.confirmedMints ?? payload?.stats?.confirmedMints,
    confirmedSupply: token.confirmedSupply ?? payload?.confirmedSupply,
    pendingMints: token.pendingMints ?? payload?.stats?.pendingMints,
    pendingSupply: token.pendingSupply ?? payload?.pendingSupply,
  };
}

function findPowToken(payload) {
  return findToken(payload, POW_TOKEN_ID, "POW");
}

function assertIndexedSupply(label, payload, tokenId, ticker) {
  const token = findToken(payload, tokenId, ticker);
  assert(token, `${label}: missing ${ticker} token row`);

  const confirmedSupply = numberValue(token.confirmedSupply);
  const confirmedMints = numberValue(token.confirmedMints);
  const maxSupply = numberValue(token.maxSupply);

  assert(maxSupply > 0, `${label}: ${ticker} max supply is missing`);
  assert(
    confirmedSupply > 0,
    `${label}: ${ticker} token row has zero confirmed supply`,
  );
  assert(
    confirmedSupply <= maxSupply,
    `${label}: ${ticker} confirmed supply exceeds max (${confirmedSupply}/${maxSupply})`,
  );
  assert(
    confirmedMints > 0,
    `${label}: ${ticker} token row has zero confirmed mints`,
  );

  return {
    confirmedMints,
    confirmedSupply,
    maxSupply,
  };
}

function assertPowMintable(label, payload) {
  const token = findPowToken(payload);
  assert(token, `${label}: missing POW token row`);

  const confirmedSupply = numberValue(token.confirmedSupply);
  const pendingSupply = numberValue(token.pendingSupply);
  const maxSupply = numberValue(token.maxSupply);
  const mintAmount = numberValue(token.mintAmount);
  const availableSupply = maxSupply - confirmedSupply - pendingSupply;

  assert(maxSupply > 0, `${label}: POW max supply is missing`);
  assert(mintAmount > 0, `${label}: POW mint amount is missing`);
  assert(
    confirmedSupply < maxSupply,
    `${label}: POW token row says minted out (${confirmedSupply}/${maxSupply})`,
  );
  assert(
    confirmedSupply + pendingSupply + mintAmount <= maxSupply,
    `${label}: POW next mint would overfill (${confirmedSupply}+${pendingSupply}+${mintAmount} > ${maxSupply})`,
  );
  assert(
    availableSupply >= mintAmount,
    `${label}: POW available supply is below one mint`,
  );

  return {
    availableSupply,
    confirmedSupply,
    maxSupply,
    mintAmount,
    pendingSupply,
  };
}

const unscopedSummary = await getJson("/api/v1/token-summary", { fresh: 1 });
const cachedScopedByIdSummary = await getJson("/api/v1/token-summary", {
  asset: POW_TOKEN_ID,
});
const scopedByIdSummary = await getJson("/api/v1/token-summary", {
  asset: POW_TOKEN_ID,
  fresh: 1,
});
const scopedByTickerSummary = await getJson("/api/v1/token-summary", {
  asset: "POW",
  fresh: 1,
});
const cachedTokenDirectory = await getJson("/api/v1/token-history", {
  kind: "tokens",
  limit: 1,
});
const freshTokenDirectory = await getJson("/api/v1/token-history", {
  fresh: 1,
  kind: "tokens",
  limit: 1,
});
const workSummary = await getJson("/api/v1/work-summary", { fresh: 1 });
const workMintHistory = await getJson("/api/v1/token-history", {
  asset: WORK_TOKEN_ID,
  fresh: 1,
  kind: "mints",
  limit: 10,
});

const unscopedPow = assertPowMintable("unscoped summary POW row", unscopedSummary);
const unscopedWork = assertIndexedSupply(
  "unscoped summary WORK row",
  unscopedSummary,
  WORK_TOKEN_ID,
  "WORK",
);
const workSummaryToken = assertIndexedSupply(
  "WORK dashboard summary row",
  workSummary?.token ?? {},
  WORK_TOKEN_ID,
  "WORK",
);
const cachedScopedByIdPow = assertPowMintable(
  "cached asset-id scoped POW summary",
  cachedScopedByIdSummary,
);
const scopedByIdPow = assertPowMintable(
  "asset-id scoped POW summary",
  scopedByIdSummary,
);
const scopedByTickerPow = assertPowMintable(
  "ticker scoped POW summary",
  scopedByTickerSummary,
);

assert(
  numberValue(scopedByIdSummary.confirmedSupply) === scopedByIdPow.confirmedSupply,
  "asset-id scoped top-level confirmed supply does not match the POW row",
);
assert(
  scopedByIdPow.confirmedSupply >= cachedScopedByIdPow.confirmedSupply,
  `asset-id scoped fresh supply regressed behind cached supply (${scopedByIdPow.confirmedSupply} < ${cachedScopedByIdPow.confirmedSupply})`,
);
assert(
  numberValue(scopedByTickerSummary.confirmedSupply) ===
    scopedByTickerPow.confirmedSupply,
  "ticker scoped top-level confirmed supply does not match the POW row",
);
assert(
  numberValue(unscopedSummary.confirmedSupply) !== unscopedPow.confirmedSupply,
  "unscoped summary is expected to expose global top-level supply distinct from POW row supply",
);
assert(
  numberValue(unscopedSummary.confirmedSupply) >= unscopedPow.confirmedSupply,
  "unscoped global supply regressed behind the POW row confirmed supply",
);
assert(
  numberValue(freshTokenDirectory.totalCount) >=
    numberValue(cachedTokenDirectory.totalCount),
  `fresh credit directory regressed behind cached directory (${freshTokenDirectory.totalCount} < ${cachedTokenDirectory.totalCount})`,
);
assert(
  timeValue(freshTokenDirectory.indexedAt) >=
    timeValue(cachedTokenDirectory.indexedAt),
  `fresh credit directory returned an older snapshot (${freshTokenDirectory.indexedAt} < ${cachedTokenDirectory.indexedAt})`,
);

const workMintHistoryCount = numberValue(workMintHistory.totalCount);
const workSummaryMintAmount =
  numberValue(workSummary?.token?.mintAmount ?? workSummaryToken.mintAmount) || 1000;
const workSummaryConfirmedMints = numberValue(
  workSummary?.token?.stats?.confirmedMints ??
    workSummaryToken.confirmedMints ??
    Math.floor(numberValue(workSummaryToken.confirmedSupply) / workSummaryMintAmount),
);
const workSummaryPendingMints = Math.max(
  numberValue(workSummary?.token?.stats?.pendingMints),
  numberValue(workSummaryToken.pendingMints),
  Math.floor(
    numberValue(
      workSummary?.token?.pendingSupply ?? workSummaryToken.pendingSupply,
    ) / workSummaryMintAmount,
  ),
);

assert(
  workMintHistoryCount === workSummaryConfirmedMints + workSummaryPendingMints,
  `WORK dashboard mint total ${workSummaryConfirmedMints}+${workSummaryPendingMints} does not match mint history ${workMintHistoryCount}`,
);

for (const txid of WORK_CONFIRMED_MINT_REGRESSION_TXIDS) {
  let found = false;
  let lastError = "";
  for (let attempt = 0; attempt < 3 && !found; attempt += 1) {
    try {
      const mintLookup = await getJson("/api/v1/token-history", {
        asset: WORK_TOKEN_ID,
        fresh: 1,
        kind: "mints",
        limit: 5,
        q: txid,
      });
      found = (Array.isArray(mintLookup.items) ? mintLookup.items : []).some(
        (item) =>
          String(item?.txid ?? "").toLowerCase() === txid &&
          item?.confirmed === true &&
          numberValue(item?.amount) === 1000 &&
          numberValue(item?.paidSats) === 1000 &&
          String(
            item?.minterAddress ??
              item?.actor ??
              item?.senderAddress ??
              "",
          ) === WORK_RECENT_MINTER_REGRESSION_ADDRESS,
      );
    } catch (error) {
      lastError = error?.message ?? String(error);
    }
    if (!found && attempt < 2) {
      await delay(1500);
    }
  }
  assert(
    found,
    `confirmed WORK mint ${txid} is missing from token-history with minter ${WORK_RECENT_MINTER_REGRESSION_ADDRESS}${lastError ? ` (${lastError})` : ""}`,
  );
}

console.log(
  `Credit mint regression checks passed for ${API_BASE}: POW ${scopedByIdPow.confirmedSupply.toLocaleString()}/${scopedByIdPow.maxSupply.toLocaleString()} confirmed, ${scopedByIdPow.pendingSupply.toLocaleString()} pending, ${scopedByIdPow.availableSupply.toLocaleString()} available; WORK ${workSummaryToken.confirmedSupply.toLocaleString()}/${workSummaryToken.maxSupply.toLocaleString()} confirmed, ${(workSummary?.token?.pendingSupply ?? 0).toLocaleString()} pending.`,
);
