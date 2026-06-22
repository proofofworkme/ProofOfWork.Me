#!/usr/bin/env node

const DEFAULT_API_BASE = "https://computer.proofofwork.me";
const API_BASE = String(process.env.POW_API_BASE ?? DEFAULT_API_BASE).replace(
  /\/+$/u,
  "",
);
const NETWORK = String(process.env.POW_NETWORK ?? "livenet");
const FETCH_TIMEOUT_MS = Number(
  process.env.POW_SEND_PREP_CHECK_TIMEOUT_MS ?? 30000,
);

const CHECKS = [
  {
    address: "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH",
    label: "armyofyouth send prep",
    minConfirmedUtxos: Number(process.env.POW_SEND_PREP_MIN_UTXOS ?? 1),
  },
];

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function fetchUtxos(check) {
  const url = new URL(
    `/api/v1/address/${encodeURIComponent(check.address)}/utxo`,
    API_BASE,
  );
  url.searchParams.set("network", NETWORK);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const apiError =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error ?? "")
        : "";
    throw new Error(
      `${check.label}: UTXO endpoint returned HTTP ${response.status}${apiError ? `: ${apiError}` : ""}`,
    );
  }
  if (!Array.isArray(payload)) {
    throw new Error(`${check.label}: UTXO endpoint did not return an array`);
  }
  return payload;
}

function assertUtxos(check, utxos) {
  const confirmed = utxos.filter((utxo) => utxo?.status?.confirmed !== false);
  const confirmedValueSats = confirmed.reduce(
    (total, utxo) => total + numberValue(utxo?.value),
    0,
  );
  if (confirmed.length < check.minConfirmedUtxos) {
    throw new Error(
      `${check.label}: expected at least ${check.minConfirmedUtxos} confirmed UTXO(s), got ${confirmed.length}`,
    );
  }
  return {
    address: check.address,
    confirmedUtxos: confirmed.length,
    confirmedValueSats,
    totalUtxos: utxos.length,
  };
}

const results = [];
for (const check of CHECKS) {
  const utxos = await fetchUtxos(check);
  results.push({
    label: check.label,
    ...assertUtxos(check, utxos),
  });
}

console.log(
  JSON.stringify(
    {
      apiBase: API_BASE,
      network: NETWORK,
      ok: true,
      results,
    },
    null,
    2,
  ),
);
