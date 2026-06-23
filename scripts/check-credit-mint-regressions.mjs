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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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
  return (Array.isArray(payload?.tokens) ? payload.tokens : []).find(
    (token) =>
      token?.tokenId === tokenId ||
      String(token?.ticker ?? "").toUpperCase() === ticker,
  );
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

const unscopedPow = assertPowMintable("unscoped summary POW row", unscopedSummary);
const unscopedWork = assertIndexedSupply(
  "unscoped summary WORK row",
  unscopedSummary,
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
  numberValue(unscopedSummary.confirmedSupply) > unscopedPow.maxSupply,
  "unscoped global supply no longer exceeds POW max; update this regression if global totals change",
);

console.log(
  `Credit mint regression checks passed for ${API_BASE}: POW ${scopedByIdPow.confirmedSupply.toLocaleString()}/${scopedByIdPow.maxSupply.toLocaleString()} confirmed, ${scopedByIdPow.pendingSupply.toLocaleString()} pending, ${scopedByIdPow.availableSupply.toLocaleString()} available; WORK ${unscopedWork.confirmedSupply.toLocaleString()}/${unscopedWork.maxSupply.toLocaleString()} confirmed.`,
);
