#!/usr/bin/env node

import { pathToFileURL } from "node:url";

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
    address: String(process.env.POW_SEND_PREP_ADDRESS ?? "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH").trim(),
    label: "confirmed-UTXO send-preparation fixture",
    minConfirmedUtxos: Number(process.env.POW_SEND_PREP_MIN_UTXOS ?? 1),
  },
];

export class SendPrepFixturePreconditionError extends Error {
  constructor(check, confirmedCount) {
    super(`${check.label}: fixture needs at least ${check.minConfirmedUtxos} confirmed UTXO(s), got ${confirmedCount}. Supply a currently funded public POW_SEND_PREP_ADDRESS; no funding or transaction was attempted.`);
    this.name = "SendPrepFixturePreconditionError";
    this.code = "fixture-precondition-not-met";
  }
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

export function assertUtxos(check, utxos) {
  if (!Number.isSafeInteger(check.minConfirmedUtxos) || check.minConfirmedUtxos < 1) {
    throw new Error("The funded-fixture minimum must be a positive safe integer.");
  }
  const seen = new Set();
  for (const utxo of utxos) {
    if (!/^[0-9a-f]{64}$/u.test(utxo?.txid ?? "") ||
      !Number.isSafeInteger(utxo?.vout) || utxo.vout < 0 ||
      !Number.isSafeInteger(utxo?.value) || utxo.value < 0 ||
      typeof utxo?.status?.confirmed !== "boolean") {
      throw new Error(`${check.label}: malformed or unqualified UTXO evidence`);
    }
    const key = `${utxo.txid}:${utxo.vout}`;
    if (seen.has(key)) throw new Error(`${check.label}: duplicate UTXO ${key}`);
    seen.add(key);
  }
  const confirmed = utxos.filter((utxo) => utxo.status.confirmed === true);
  const confirmedValueSats = confirmed.reduce(
    (total, utxo) => total + BigInt(utxo.value),
    0n,
  );
  if (confirmed.length < check.minConfirmedUtxos) {
    throw new SendPrepFixturePreconditionError(check, confirmed.length);
  }
  return {
    address: check.address,
    confirmedUtxos: confirmed.length,
    confirmedValueSats: confirmedValueSats.toString(),
    totalUtxos: utxos.length,
  };
}

async function main() {
  try {
    const results = [];
    for (const check of CHECKS) {
      const utxos = await fetchUtxos(check);
      results.push({ label: check.label, ...assertUtxos(check, utxos) });
    }
    console.log(JSON.stringify({
      apiBase: API_BASE,
      network: NETWORK,
      ok: true,
      scope: "UTXO read and funded-fixture precondition; no transaction construction, signing or broadcast",
      results,
    }, null, 2));
  } catch (error) {
    const precondition = error instanceof SendPrepFixturePreconditionError;
    console.log(JSON.stringify({
      apiBase: API_BASE, network: NETWORK, ok: false,
      status: precondition ? "precondition-unmet" : "failed",
      code: precondition ? error.code : "utxo-read-or-contract-failed",
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = precondition ? 2 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
